/**
 * useStreamingSearch - EventSource hook for live streaming search results.
 *
 * Connects to /api/search/stream via SSE. Each tool invocation emits
 * tool_start + tool_done events with full telemetry.
 */

import { useCallback, useRef, useState } from "react";
import { PUBLIC_SEARCH_API_ENDPOINT, PUBLIC_SEARCH_STREAM_API_ENDPOINT } from "../lib/searchApi";

export interface ToolStage {
  tool: string;
  provider: string;
  model?: string;
  step: number;
  totalPlanned: number;
  reason?: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  preview?: string | Record<string, any>;
  startedAt: number;
}

export interface StreamingSourcePreview {
  id: string;
  label: string;
  href?: string;
  domain?: string;
}

export interface StreamingMilestones {
  startedAt: number | null;
  firstStageAt: number | null;
  firstSourceAt: number | null;
  firstPartialAnswerAt: number | null;
  completedAt: number | null;
}

export interface StreamingRoutingState {
  routingMode: "executive" | "advisor";
  routingReason?: string;
  routingSource?: "automatic" | "user_forced";
  plannerModel?: string;
  executionModel?: string;
  reasoningEffort?: "medium" | "high";
}

export interface StreamingSearchState {
  stages: ToolStage[];
  plan: Array<{ tool: string; provider: string; model?: string; reason: string }> | null;
  routing: StreamingRoutingState | null;
  result: Record<string, unknown> | null;
  isStreaming: boolean;
  error: string | null;
  totalDurationMs: number;
  sourcePreview: StreamingSourcePreview[];
  liveAnswerPreview: string | null;
  milestones: StreamingMilestones;
}

export interface StreamingToolStartPayload {
  tool: string;
  provider: string;
  model?: string;
  step: number;
  totalPlanned: number;
  reason?: string;
}

export interface StreamingToolDonePayload {
  tool: string;
  step: number;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  preview?: unknown;
}

export interface StreamingCompletePayload {
  packet?: Record<string, unknown>;
  totalDurationMs?: number;
  routingMode?: StreamingRoutingState["routingMode"];
  routingReason?: string;
  routingSource?: StreamingRoutingState["routingSource"];
  plannerModel?: string;
  executionModel?: string;
  reasoningEffort?: StreamingRoutingState["reasoningEffort"];
  [key: string]: unknown;
}

interface StreamingCallbacks {
  onToolStart?: (payload: StreamingToolStartPayload) => void;
  onToolDone?: (payload: StreamingToolDonePayload) => void;
  onComplete?: (payload: StreamingCompletePayload) => void;
  onError?: (message: string) => void;
}

interface StreamingRunOptions {
  contextHint?: string;
}

type ParsedSseEvent = {
  event: string;
  data: string;
};

type FallbackSearchResponse = Record<string, unknown>;

function formatList(items: Array<string | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ");
}

function formatPreview(preview: unknown) {
  if (typeof preview === "string") return preview.trim() || undefined;
  if (!preview || typeof preview !== "object") return undefined;

  const record = preview as Record<string, unknown>;

  if (typeof record.entity === "string" || typeof record.classification === "string") {
      return formatList([
        typeof record.entity === "string" && record.entity.trim() ? `${record.entity.trim()} detected.` : null,
        typeof record.classification === "string" && record.classification.trim()
          ? `Request looks like ${humanizeValue(record.classification.trim())}.`
          : null,
      ]);
  }

  if (
    typeof record.sourceCount === "number" ||
    typeof record.topSource === "string" ||
    typeof record.answerSnippet === "string"
  ) {
    return formatList([
      typeof record.sourceCount === "number" ? `${record.sourceCount} sources gathered.` : null,
      typeof record.topSource === "string" && record.topSource.trim() ? `Top source: ${record.topSource.trim()}.` : null,
    ]);
  }

  if (
    typeof record.entityName === "string" ||
    typeof record.signalCount === "number" ||
    typeof record.riskCount === "number"
  ) {
    return formatList([
      typeof record.entityName === "string" && record.entityName.trim() ? `${record.entityName.trim()} analyzed.` : null,
      typeof record.signalCount === "number" ? `${record.signalCount} useful signals found.` : null,
      typeof record.riskCount === "number" ? `${record.riskCount} risk areas flagged.` : null,
    ]);
  }

  if (
    typeof record.classifiedSignals === "number" ||
    typeof record.verifiedCount === "number" ||
    typeof record.contradictedCount === "number"
  ) {
    return formatList([
      typeof record.classifiedSignals === "number" ? `${record.classifiedSignals} report signals packaged.` : null,
      typeof record.verifiedCount === "number" ? `${record.verifiedCount} verified evidence spans.` : null,
      typeof record.contradictedCount === "number" && record.contradictedCount > 0
        ? `${record.contradictedCount} contradictions need review.`
        : null,
    ]);
  }

  if (typeof record.verdict === "string" || typeof record.replayCount === "number") {
    return formatList([
      typeof record.verdict === "string" ? `Replay check: ${record.verdict}.` : null,
      typeof record.replayCount === "number" ? `${record.replayCount} similar runs found.` : null,
      typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : null,
    ]);
  }

  return undefined;
}

function parseSourcePreview(preview: unknown): StreamingSourcePreview[] {
  if (!preview || typeof preview !== "object") return [];

  const previewRecord = preview as { topSources?: unknown[]; topSource?: unknown };
  const topSources = Array.isArray(previewRecord.topSources) ? previewRecord.topSources : [];
  const normalized = topSources
    .map((candidate, index) => {
      if (!candidate || typeof candidate !== "object") return null;
      const item = candidate as { id?: unknown; label?: unknown; href?: unknown; domain?: unknown };
      const label = typeof item.label === "string" ? item.label.trim() : "";
      if (!label) return null;
      return {
        id: typeof item.id === "string" && item.id ? item.id : `preview-source-${index}`,
        label,
        href: typeof item.href === "string" ? item.href : undefined,
        domain: typeof item.domain === "string" ? item.domain : undefined,
      } satisfies StreamingSourcePreview;
    })
    .filter((item: any) => item !== null) as StreamingSourcePreview[];

  if (normalized.length > 0) return normalized;

  const topSource = typeof previewRecord.topSource === "string" ? previewRecord.topSource.trim() : "";
  if (!topSource) return [];
  return [{ id: "preview-source-top", label: topSource }];
}

function parseAnswerPreview(preview: unknown): string | null {
  if (!preview || typeof preview !== "object") return null;
  const answerPreview = (preview as { answerPreview?: unknown }).answerPreview;
  return typeof answerPreview === "string" && answerPreview.trim() ? answerPreview.trim() : null;
}

function parsePacketSourcePreview(packet: Record<string, unknown> | null | undefined): StreamingSourcePreview[] {
  const refs = Array.isArray(packet?.sourceRefs) ? packet.sourceRefs : [];
  return refs
    .map((source, index) => {
      if (!source || typeof source !== "object") return null;
      const ref = source as { id?: unknown; label?: unknown; href?: unknown; domain?: unknown };
      const label = typeof ref.label === "string" ? ref.label.trim() : "";
      if (!label) return null;
      return {
        id: typeof ref.id === "string" && ref.id ? ref.id : `packet-source-${index}`,
        label,
        href: typeof ref.href === "string" ? ref.href : undefined,
        domain: typeof ref.domain === "string" ? ref.domain : undefined,
      } satisfies StreamingSourcePreview;
    })
    .filter((item: any) => item !== null) as StreamingSourcePreview[];
}

function flushSseBuffer(
  buffer: string,
  onEvent: (event: ParsedSseEvent) => void,
): string {
  let working = buffer.replace(/\r\n/g, "\n");
  while (true) {
    const boundaryIndex = working.indexOf("\n\n");
    if (boundaryIndex === -1) break;
    const block = working.slice(0, boundaryIndex);
    working = working.slice(boundaryIndex + 2);

    const lines = block.split(/\r?\n/);
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (dataLines.length === 0) continue;
    onEvent({ event: eventName, data: dataLines.join("\n") });
  }
  return working;
}

function safelyInvokeCallback<TPayload>(
  callback: ((payload: TPayload) => void) | undefined,
  payload: TPayload,
) {
  if (!callback) return;
  try {
    callback(payload);
  } catch (error) {
    console.warn("[useStreamingSearch] callback failed", error);
  }
}

function mapFallbackSearchResponse(
  data: FallbackSearchResponse,
): StreamingCompletePayload | null {
  const resultRecord =
    data.result && typeof data.result === "object"
      ? (data.result as Record<string, unknown>)
      : null;

  const packet =
    data.resultPacket && typeof data.resultPacket === "object"
      ? (data.resultPacket as Record<string, unknown>)
      : data.packet && typeof data.packet === "object"
        ? (data.packet as Record<string, unknown>)
        : resultRecord?.resultPacket && typeof resultRecord.resultPacket === "object"
          ? (resultRecord.resultPacket as Record<string, unknown>)
          : typeof data.answer === "string" || Array.isArray(data.sourceRefs)
            ? data
            : null;

  if (!packet) return null;

  return {
    packet,
    totalDurationMs:
      typeof data.latencyMs === "number"
        ? data.latencyMs
        : typeof data.durationMs === "number"
          ? data.durationMs
          : typeof resultRecord?.latencyMs === "number"
            ? resultRecord.latencyMs
            : undefined,
    routingMode:
      data.routingMode === "advisor" || data.routingMode === "executive"
        ? data.routingMode
        : undefined,
    routingReason: typeof data.routingReason === "string" ? data.routingReason : undefined,
    routingSource:
      data.routingSource === "automatic" || data.routingSource === "user_forced"
        ? data.routingSource
        : undefined,
    plannerModel: typeof data.plannerModel === "string" ? data.plannerModel : undefined,
    executionModel: typeof data.executionModel === "string" ? data.executionModel : undefined,
    reasoningEffort:
      data.reasoningEffort === "medium" || data.reasoningEffort === "high"
        ? data.reasoningEffort
        : undefined,
    // Pass through low-confidence signal produced by the backend guard at
    // server/routes/search.ts. Consumers read these via the index signature.
    // See: convex/domains/agents/safety/lowConfidenceGuard.ts
    retrievalConfidence:
      data.retrievalConfidence === "high" ||
      data.retrievalConfidence === "medium" ||
      data.retrievalConfidence === "low"
        ? data.retrievalConfidence
        : undefined,
    lowConfidenceCard:
      data.lowConfidenceCard && typeof data.lowConfidenceCard === "object"
        ? (data.lowConfidenceCard as Record<string, unknown>)
        : undefined,
  };
}

function normalizeStreamingErrorMessage(message: string) {
  const normalized = message.trim();
  if (!normalized) {
    return "NodeBench could not refresh this answer right now.";
  }

  const lower = normalized.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("connection to search server failed")) {
    return "NodeBench could not reach the live search service right now. Try again in a moment.";
  }
  if (lower.includes("timed out")) {
    return "NodeBench took too long to refresh this answer. Try again or narrow the query.";
  }
  if (lower.includes("search stream ended before completion")) {
    return "NodeBench lost the live stream before the answer finished. Try again in a moment.";
  }
  if (lower.startsWith("search failed")) {
    return "NodeBench could not complete the live refresh right now.";
  }
  return normalized;
}

export function useStreamingSearch(): StreamingSearchState & {
  startStream: (query: string, lens: string, callbacks?: StreamingCallbacks, options?: StreamingRunOptions) => void;
  stopStream: () => void;
  resetStream: () => void;
} {
  const [stages, setStages] = useState<ToolStage[]>([]);
  const [plan, setPlan] = useState<StreamingSearchState["plan"]>(null);
  const [routing, setRouting] = useState<StreamingRoutingState | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalDurationMs, setTotalDurationMs] = useState(0);
  const [sourcePreview, setSourcePreview] = useState<StreamingSourcePreview[]>([]);
  const [liveAnswerPreview, setLiveAnswerPreview] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<StreamingMilestones>({
    startedAt: null,
    firstStageAt: null,
    firstSourceAt: null,
    firstPartialAnswerAt: null,
    completedAt: null,
  });
  const abortControllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const resetStreamState = useCallback(() => {
    setStages([]);
    setPlan(null);
    setRouting(null);
    setResult(null);
    setError(null);
    setTotalDurationMs(0);
    setSourcePreview([]);
    setLiveAnswerPreview(null);
    setMilestones({
      startedAt: null,
      firstStageAt: null,
      firstSourceAt: null,
      firstPartialAnswerAt: null,
      completedAt: null,
    });
  }, []);

  const stopStream = useCallback(() => {
    runIdRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const resetStream = useCallback(() => {
    stopStream();
    resetStreamState();
  }, [resetStreamState, stopStream]);

  const startStream = useCallback(
    (query: string, lens: string, callbacks?: StreamingCallbacks, options?: StreamingRunOptions) => {
      stopStream();
      const runId = runIdRef.current;
      setStages([]);
      setPlan(null);
      setRouting(null);
      setResult(null);
      setError(null);
      setIsStreaming(true);
      setTotalDurationMs(0);
      setSourcePreview([]);
      setLiveAnswerPreview(null);
      setMilestones({
        startedAt: Date.now(),
        firstStageAt: null,
        firstSourceAt: null,
        firstPartialAnswerAt: null,
        completedAt: null,
      });

      const contextHint = options?.contextHint?.trim();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      let didComplete = false;
      let recoveryAttempted = false;
      const isActiveRun = () =>
        abortControllerRef.current === controller && runIdRef.current === runId;

      const handleToolStart = (data: StreamingToolStartPayload) => {
        if (!isActiveRun()) return;
        const now = Date.now();
        setStages((prev) => [
          ...prev,
          {
            tool: data.tool,
            provider: data.provider,
            model: data.model,
            step: data.step,
            totalPlanned: data.totalPlanned,
            reason: data.reason,
            status: "running",
            startedAt: now,
          },
        ]);
        setMilestones((prev) => ({
          ...prev,
          firstStageAt: prev.firstStageAt ?? now,
        }));
        safelyInvokeCallback(callbacks?.onToolStart, data);
      };

      const handleToolDone = (data: StreamingToolDonePayload) => {
        if (!isActiveRun()) return;
        const now = Date.now();
        const previewSources = parseSourcePreview(data.preview);
        const answerPreview = parseAnswerPreview(data.preview);
        setStages((prev) =>
          prev.map((stage) =>
            stage.tool === data.tool && stage.step === data.step
              ? {
                  ...stage,
                  status: "done",
                  durationMs: data.durationMs,
                  tokensIn: data.tokensIn,
                  tokensOut: data.tokensOut,
                  preview: formatPreview(data.preview),
                }
              : stage,
          ),
        );
        if (previewSources.length > 0) {
          setSourcePreview((prev) => (prev.length > 0 ? prev : previewSources));
          setMilestones((prev) => ({
            ...prev,
            firstSourceAt: prev.firstSourceAt ?? now,
          }));
        }
        if (answerPreview) {
          setLiveAnswerPreview((prev) => prev ?? answerPreview);
          setMilestones((prev) => ({
            ...prev,
            firstPartialAnswerAt: prev.firstPartialAnswerAt ?? now,
          }));
        }
        safelyInvokeCallback(callbacks?.onToolDone, data);
      };

      const handlePlan = (
        data: {
          tools: Array<{ tool: string; provider: string; model?: string; reason: string }>;
          totalTools: number;
          routingMode?: StreamingRoutingState["routingMode"];
          routingReason?: string;
          routingSource?: StreamingRoutingState["routingSource"];
          plannerModel?: string;
          executionModel?: string;
          reasoningEffort?: StreamingRoutingState["reasoningEffort"];
        },
      ) => {
        if (!isActiveRun()) return;
        setPlan(data.tools);
        setRouting(
          data.routingMode
            ? {
                routingMode: data.routingMode,
                routingReason: data.routingReason,
                routingSource: data.routingSource,
                plannerModel: data.plannerModel,
                executionModel: data.executionModel,
                reasoningEffort: data.reasoningEffort,
              }
            : null,
        );
        setStages((prev) => prev.map((stage) => ({ ...stage, totalPlanned: data.totalTools })));
      };

      const handleComplete = (data: StreamingCompletePayload) => {
        if (!isActiveRun()) return;
        const packet = (data.packet ?? data) as Record<string, unknown>;
        const now = Date.now();
        const packetSources = parsePacketSourcePreview(packet);
        const packetAnswer = typeof packet.answer === "string" ? packet.answer.trim() : "";

        setResult(packet);
        if (data.routingMode) {
          setRouting((prev) =>
            prev ?? {
              routingMode: data.routingMode!,
              routingReason: data.routingReason,
              routingSource: data.routingSource,
              plannerModel: data.plannerModel,
              executionModel: data.executionModel,
              reasoningEffort: data.reasoningEffort,
            },
          );
        }
        setTotalDurationMs(data.totalDurationMs ?? 0);
        setIsStreaming(false);
        if (packetSources.length > 0) {
          setSourcePreview((prev) => (prev.length > 0 ? prev : packetSources));
        }
        if (packetAnswer) {
          setLiveAnswerPreview((prev) => prev ?? packetAnswer);
        }
        setMilestones((prev) => ({
          ...prev,
          firstSourceAt: prev.firstSourceAt ?? (packetSources.length > 0 ? now : null),
          firstPartialAnswerAt: prev.firstPartialAnswerAt ?? (packetAnswer ? now : null),
          completedAt: now,
        }));
        abortControllerRef.current = null;
        safelyInvokeCallback(callbacks?.onComplete, data);
      };

      const handleError = (message: string) => {
        if (!isActiveRun()) return;
        const friendlyMessage = normalizeStreamingErrorMessage(message);
        setError(friendlyMessage);
        setIsStreaming(false);
        abortControllerRef.current = null;
        safelyInvokeCallback(callbacks?.onError, friendlyMessage);
      };

      const recoverFromTerminalStreamFailure = async (): Promise<boolean> => {
        if (recoveryAttempted || controller.signal.aborted || !isActiveRun()) return false;
        recoveryAttempted = true;

        try {
          const response = await fetch(PUBLIC_SEARCH_API_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              query,
              lens,
              contextHint,
            }),
            signal: controller.signal,
          });

          if (!response.ok) return false;

          const raw = (await response.json()) as FallbackSearchResponse;
          const completion = mapFallbackSearchResponse(raw);
          if (!completion) return false;
          if (!isActiveRun()) return false;

          clearTimeout(timeout);
          didComplete = true;
          handleComplete(completion);
          return true;
        } catch {
          return false;
        }
      };

      const timeout = setTimeout(() => {
        if (isActiveRun()) {
          controller.abort("timeout");
          handleError("Search timed out after 60 seconds");
        }
      }, 60000);

      void (async () => {
        try {
          const response = await fetch(PUBLIC_SEARCH_STREAM_API_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              query,
              lens,
              contextHint,
            }),
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            throw new Error(`Search failed (${response.status})`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!isActiveRun()) {
              await reader.cancel().catch(() => undefined);
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            buffer = flushSseBuffer(buffer, ({ event, data }) => {
              try {
                if (event === "tool_start") handleToolStart(JSON.parse(data) as StreamingToolStartPayload);
                else if (event === "tool_done") handleToolDone(JSON.parse(data) as StreamingToolDonePayload);
                else if (event === "plan") {
                  handlePlan(JSON.parse(data) as {
                    tools: Array<{ tool: string; provider: string; model?: string; reason: string }>;
                    totalTools: number;
                    routingMode?: StreamingRoutingState["routingMode"];
                    routingReason?: string;
                    routingSource?: StreamingRoutingState["routingSource"];
                    plannerModel?: string;
                    executionModel?: string;
                    reasoningEffort?: StreamingRoutingState["reasoningEffort"];
                  });
                } else if (event === "complete") {
                  clearTimeout(timeout);
                  didComplete = true;
                  handleComplete(JSON.parse(data) as StreamingCompletePayload);
                } else if (event === "error") {
                  clearTimeout(timeout);
                  const parsed = JSON.parse(data) as { message?: string };
                  handleError(parsed.message ?? "Search failed");
                }
              } catch (error) {
                handleError(error instanceof Error ? error.message : "Search failed");
              }
            });
            if (didComplete) {
              await reader.cancel().catch(() => undefined);
              break;
            }
          }

          if (!isActiveRun()) return;
          buffer += decoder.decode();
          if (!didComplete && buffer.trim().length > 0) {
            flushSseBuffer(`${buffer}\n\n`, ({ event, data }) => {
              if (event === "complete") {
                if (!isActiveRun()) return;
                clearTimeout(timeout);
                didComplete = true;
                handleComplete(JSON.parse(data) as StreamingCompletePayload);
              }
            });
          }

          if (!didComplete && !controller.signal.aborted && isActiveRun()) {
            const recovered = await recoverFromTerminalStreamFailure();
            if (!recovered) {
              handleError("Search stream ended before completion.");
            }
          }
        } catch (error) {
          clearTimeout(timeout);
          if (controller.signal.aborted || didComplete || !isActiveRun()) return;
          const recovered = await recoverFromTerminalStreamFailure();
          if (recovered) return;
          handleError(error instanceof Error ? error.message : "Connection to search server failed. Is the server running?");
        }
      })();
    },
    [stopStream],
  );

  return {
    stages,
    plan,
    routing,
    result,
    isStreaming,
    error,
    totalDurationMs,
    sourcePreview,
    liveAnswerPreview,
    milestones,
    startStream,
    stopStream,
    resetStream,
  };
}
