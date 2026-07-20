/**
 * OpenTelemetry Observability for Agent System
 *
 * Industry Pattern (2026): Distributed tracing for LLM applications
 * - Trace agent workflows end-to-end (swarm execution, delegations, tool calls)
 * - Track LLM metrics (model, tokens, cost, latency)
 * - Correlate events across distributed system
 *
 * Based on:
 * - OpenTelemetry standards for LLM observability (2024-2026)
 * - Langfuse, Datadog, LangSmith best practices
 * - Vercel AI SDK telemetry patterns
 *
 * Integration: Langfuse (free, open-source)
 * https://langfuse.com/docs
 */

import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trace = Top-level execution unit (swarm, workflow, agent session)
 * Span = Individual operation within trace (LLM call, tool invocation, search)
 * Event = Point-in-time occurrence (cache hit, error, approval requested)
 */

export type TraceLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export interface TraceMetadata {
  userId?: string;
  sessionId?: string;
  tags?: string[]; // e.g., ["swarm", "financial-analysis", "jpm-banker"]
  metadata?: Record<string, any>;
}

export interface SpanAttributes {
  // LLM attributes (OpenTelemetry semantic conventions)
  "llm.provider"?: string; // anthropic, openai, google
  "llm.model"?: string; // claude-opus-4.7, gpt-5.4, gemini-3.1-pro-preview
  "llm.temperature"?: number;
  "llm.max_tokens"?: number;
  "llm.top_p"?: number;

  // Token usage
  "llm.usage.input_tokens"?: number;
  "llm.usage.output_tokens"?: number;
  "llm.usage.total_tokens"?: number;
  "llm.usage.cache_read_tokens"?: number; // Prompt caching
  "llm.usage.cache_write_tokens"?: number;

  // Cost tracking
  "llm.cost.total"?: number; // USD
  "llm.cost.input"?: number;
  "llm.cost.output"?: number;
  "llm.cost.cache"?: number;

  // Performance
  "llm.latency_ms"?: number;
  "llm.time_to_first_token_ms"?: number; // Streaming

  // Tool usage
  "tool.name"?: string;
  "tool.status"?: "success" | "failure";
  "tool.error"?: string;

  // Agent-specific
  "agent.type"?: "swarm" | "delegation" | "specialist";
  "agent.role"?: string; // "JPM_BANKER", "CTO_LEAD", etc.
  "agent.task_count"?: number;

  // Search-specific
  "search.query"?: string;
  "search.sources"?: string[]; // brave, tavily, perplexity
  "search.fusion_strategy"?: string; // rrf, semantic
  "search.results_count"?: number;

  // Custom
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface Trace {
  traceId: string; // UUID for entire execution
  name: string; // "swarm_execution", "workflow_daily_brief", etc.
  startTime: number; // Unix timestamp ms
  endTime?: number;
  level: TraceLevel;
  metadata: TraceMetadata;
  spans: Span[];
  totalCost?: number; // Aggregated cost across all LLM calls
  totalTokens?: number;
  status: "running" | "completed" | "error";
  error?: string;
}

export interface Span {
  spanId: string; // UUID for this operation
  parentSpanId?: string; // For nested operations
  traceId: string; // Links to parent trace
  name: string; // "llm_call", "tool_invocation", "synthesis", etc.
  startTime: number;
  endTime?: number;
  attributes: SpanAttributes;
  events: SpanEvent[]; // Point-in-time occurrences
  status: "running" | "completed" | "error";
  error?: string;
}

export interface SpanEvent {
  timestamp: number;
  name: string; // "cache_hit", "reasoning_step", "approval_requested"
  attributes: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════════════
// TELEMETRY LOGGER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TelemetryLogger - In-memory trace builder for Convex
 *
 * Usage pattern:
 * 1. Create trace at start of operation
 * 2. Create spans for each sub-operation (LLM calls, tool usage, etc.)
 * 3. End spans when operations complete
 * 4. End trace when entire workflow finishes
 * 5. Persist trace to Convex database
 * 6. Export to external platforms (Langfuse, Datadog) via webhook
 */
export class TelemetryLogger {
  private trace: Trace;
  private activeSpans: Map<string, Span> = new Map();

  constructor(
    traceName: string,
    metadata: TraceMetadata = {},
    traceId?: string
  ) {
    this.trace = {
      traceId: traceId || this.generateId(),
      name: traceName,
      startTime: Date.now(),
      level: "INFO",
      metadata,
      spans: [],
      status: "running",
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // TRACE MANAGEMENT
  // ───────────────────────────────────────────────────────────────────────

  getTraceId(): string {
    return this.trace.traceId;
  }

  setTraceMetadata(metadata: Partial<TraceMetadata>): void {
    this.trace.metadata = { ...this.trace.metadata, ...metadata };
  }

  endTrace(status: "completed" | "error" = "completed", error?: string): Trace {
    this.trace.endTime = Date.now();
    this.trace.status = status;
    if (error) this.trace.error = error;

    // Aggregate costs and tokens
    this.trace.totalCost = this.trace.spans.reduce(
      (sum, span) => sum + (span.attributes["llm.cost.total"] || 0),
      0
    );
    this.trace.totalTokens = this.trace.spans.reduce(
      (sum, span) => sum + (span.attributes["llm.usage.total_tokens"] || 0),
      0
    );

    return this.trace;
  }

  // ───────────────────────────────────────────────────────────────────────
  // SPAN MANAGEMENT
  // ───────────────────────────────────────────────────────────────────────

  startSpan(
    spanName: string,
    attributes: SpanAttributes = {},
    parentSpanId?: string
  ): string {
    const spanId = this.generateId();
    const span: Span = {
      spanId,
      parentSpanId,
      traceId: this.trace.traceId,
      name: spanName,
      startTime: Date.now(),
      attributes,
      events: [],
      status: "running",
    };

    this.activeSpans.set(spanId, span);
    return spanId;
  }

  endSpan(
    spanId: string,
    status: "completed" | "error" = "completed",
    error?: string
  ): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.status = status;
    if (error) span.error = error;

    // Calculate latency
    span.attributes["llm.latency_ms"] = span.endTime - span.startTime;

    this.activeSpans.delete(spanId);
    this.trace.spans.push(span);
  }

  addSpanEvent(spanId: string, eventName: string, attributes: Record<string, any> = {}): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.events.push({
        timestamp: Date.now(),
        name: eventName,
        attributes,
      });
    }
  }

  updateSpanAttributes(spanId: string, attributes: Partial<SpanAttributes>): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.attributes = { ...span.attributes, ...attributes };
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // CONVENIENCE METHODS FOR COMMON PATTERNS
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Log LLM call with full observability
   */
  async traceLLMCall<T>(
    modelProvider: string,
    modelName: string,
    operation: () => Promise<T>,
    attributes: Partial<SpanAttributes> = {}
  ): Promise<T> {
    const spanId = this.startSpan("llm_call", {
      "llm.provider": modelProvider,
      "llm.model": modelName,
      ...attributes,
    });

    const startTime = Date.now();

    try {
      const result = await operation();

      // Operation should update span with token usage via updateSpanAttributes
      this.endSpan(spanId, "completed");

      return result;
    } catch (error: any) {
      this.endSpan(spanId, "error", error.message);
      throw error;
    }
  }

  /**
   * Log tool invocation
   */
  async traceToolCall<T>(
    toolName: string,
    operation: () => Promise<T>,
    attributes: Partial<SpanAttributes> = {}
  ): Promise<T> {
    const spanId = this.startSpan("tool_call", {
      "tool.name": toolName,
      ...attributes,
    });

    try {
      const result = await operation();
      this.updateSpanAttributes(spanId, { "tool.status": "success" });
      this.endSpan(spanId, "completed");
      return result;
    } catch (error: any) {
      this.updateSpanAttributes(spanId, {
        "tool.status": "failure",
        "tool.error": error.message,
      });
      this.endSpan(spanId, "error", error.message);
      throw error;
    }
  }

  /**
   * Log agent execution (swarm member, specialist)
   */
  startAgentSpan(
    agentType: string,
    agentRole: string,
    attributes: Partial<SpanAttributes> = {}
  ): string {
    return this.startSpan(`agent_${agentType}`, {
      "agent.type": agentType as any,
      "agent.role": agentRole,
      ...attributes,
    });
  }

  /**
   * Log search operation
   */
  startSearchSpan(
    query: string,
    sources: string[],
    attributes: Partial<SpanAttributes> = {}
  ): string {
    return this.startSpan("search", {
      "search.query": query,
      "search.sources": sources,
      ...attributes,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ───────────────────────────────────────────────────────────────────────

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Export trace in OpenTelemetry JSON format
   */
  toJSON(): Trace {
    return this.trace;
  }

  /**
   * Export in Langfuse format (for webhook integration)
   */
  toLangfuseFormat() {
    return {
      id: this.trace.traceId,
      name: this.trace.name,
      userId: this.trace.metadata.userId,
      sessionId: this.trace.metadata.sessionId,
      timestamp: new Date(this.trace.startTime).toISOString(),
      metadata: this.trace.metadata.metadata,
      tags: this.trace.metadata.tags,
      spans: this.trace.spans.map((span) => ({
        id: span.spanId,
        traceId: span.traceId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        startTime: new Date(span.startTime).toISOString(),
        endTime: span.endTime ? new Date(span.endTime).toISOString() : undefined,
        level: span.status === "error" ? "ERROR" : "INFO",
        statusMessage: span.error,
        metadata: span.attributes,
        input: span.events.find((e) => e.name === "input")?.attributes,
        output: span.events.find((e) => e.name === "output")?.attributes,
      })),
      output: {
        totalCost: this.trace.totalCost,
        totalTokens: this.trace.totalTokens,
        status: this.trace.status,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE USAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: Swarm Orchestrator with Telemetry
 *
 * const logger = new TelemetryLogger("swarm_execution", {
 *   userId: "user_123",
 *   sessionId: "session_456",
 *   tags: ["swarm", "financial-analysis"],
 * });
 *
 * // Start swarm span
 * const swarmSpanId = logger.startAgentSpan("swarm", "multi_agent", {
 *   "agent.task_count": 5,
 * });
 *
 * // For each agent in swarm
 * for (const agent of agents) {
 *   const agentSpanId = logger.startAgentSpan("specialist", agent.role, {}, swarmSpanId);
 *
 *   // LLM call within agent
 *   const llmSpanId = logger.startSpan("llm_call", {
 *     "llm.provider": "anthropic",
 *     "llm.model": "claude-sonnet-4-6",
 *   }, agentSpanId);
 *
 *   const response = await callLLM();
 *
 *   logger.updateSpanAttributes(llmSpanId, {
 *     "llm.usage.input_tokens": response.usage.input_tokens,
 *     "llm.usage.output_tokens": response.usage.output_tokens,
 *     "llm.cost.total": calculateCost(response.usage),
 *   });
 *
 *   logger.endSpan(llmSpanId);
 *   logger.endSpan(agentSpanId);
 * }
 *
 * logger.endSpan(swarmSpanId);
 *
 * // End trace and persist
 * const trace = logger.endTrace("completed");
 * await ctx.runMutation(internal.observability.saveTrace, { trace });
 */

// ═══════════════════════════════════════════════════════════════════════════
// METRICS AGGREGATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate metrics across traces for dashboards
 */
export interface AggregatedMetrics {
  // Request metrics
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;

  // Token metrics
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheHitTokens: number;
  cacheHitRate: number; // %

  // Cost metrics
  totalCost: number; // USD
  avgCostPerRequest: number;
  costByModel: Record<string, number>;
  costByUser: Record<string, number>;

  // Performance
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;

  // Agent-specific
  agentExecutions: Record<string, number>; // By role
  toolInvocations: Record<string, number>; // By tool name
}

export function aggregateTraces(traces: Trace[]): AggregatedMetrics {
  const latencies: number[] = [];
  let totalTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let cacheHitTokens = 0;
  let totalCost = 0;
  const costByModel: Record<string, number> = {};
  const costByUser: Record<string, number> = {};
  const agentExecutions: Record<string, number> = {};
  const toolInvocations: Record<string, number> = {};

  for (const trace of traces) {
    if (trace.endTime) {
      latencies.push(trace.endTime - trace.startTime);
    }

    totalCost += trace.totalCost || 0;

    const userId = trace.metadata.userId || "unknown";
    costByUser[userId] = (costByUser[userId] || 0) + (trace.totalCost || 0);

    for (const span of trace.spans) {
      const inputTokens = span.attributes["llm.usage.input_tokens"] || 0;
      const outputTokens = span.attributes["llm.usage.output_tokens"] || 0;
      const cacheRead = span.attributes["llm.usage.cache_read_tokens"] || 0;
      const model = span.attributes["llm.model"];
      const spanCost = span.attributes["llm.cost.total"] || 0;
      const agentRole = span.attributes["agent.role"];
      const toolName = span.attributes["tool.name"];

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalTokens += inputTokens + outputTokens;
      cacheHitTokens += cacheRead;

      if (model) {
        costByModel[model] = (costByModel[model] || 0) + spanCost;
      }

      if (agentRole) {
        agentExecutions[agentRole] = (agentExecutions[agentRole] || 0) + 1;
      }

      if (toolName) {
        toolInvocations[toolName] = (toolInvocations[toolName] || 0) + 1;
      }
    }
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  return {
    totalRequests: traces.length,
    successfulRequests: traces.filter((t) => t.status === "completed").length,
    failedRequests: traces.filter((t) => t.status === "error").length,
    avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    cacheHitTokens,
    cacheHitRate: totalInputTokens > 0 ? (cacheHitTokens / totalInputTokens) * 100 : 0,
    totalCost,
    avgCostPerRequest: traces.length > 0 ? totalCost / traces.length : 0,
    costByModel,
    costByUser,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    agentExecutions,
    toolInvocations,
  };
}
